---
type: "Work Package Spec"
title: "WP 6.7 (AM-OB7) — chart composer type-set completion"
description: "The composer offers three chart types; this adds radar (already available upstream and already used in the Report tab) and the ratio measure, and raises histogram and pivot as genuine upstream gaps rather than hand-rolling them."
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-21T16:05:00Z"
status: "draft"
---
# WP 6.7 (AM-OB7) — chart composer type-set completion

## Verification finding

**The composer ships exactly three chart types. Of the three the amendment asks to add, one is
available upstream and already in production elsewhere in this app; two do not exist upstream at all.**

The shipped composer (WP 2.7), all under `apps/web/src/features/dashboard/testing/`:

- `ChartComposerDialog.tsx` (529 lines) — the create/edit dialog with live preview.
- `CustomChartCanvas.tsx` (124 lines) — the **single** rendering surface shared by preview and
  persisted panel.
- `CustomChartPanel.tsx`, `CustomChartsSection.tsx` — panel + list (mounted at `TestingTab.tsx:222`).
- Server: `apps/api/src/observability/dashboard-charts.ts` over the `dashboard_charts` table
  (migration v45).

**The type set is three, and the picker is generated from the constant:**

```
export const DASHBOARD_CHART_TYPES = ["line", "bar", "stacked"] as const;   // constants.ts:466
export type DashboardChartType = (typeof DASHBOARD_CHART_TYPES)[number];    // types.ts:4977
```

`ChartComposerDialog.tsx:317-323` renders a `SegmentedField` whose options map straight off that
constant, so the picker literally reads *Line · Bar · Stacked*. The renderer honours exactly those:
the `line` branch at `CustomChartCanvas.tsx:69-88`, everything else falling through to a `BarChart`
with `stacked={chartType === "stacked"}` at `:90-108`. There is no fourth branch and no `default`.

The composer imports exactly eight symbols from `@elabs-ai/components-charts`, from **one** site
(`CustomChartCanvas.tsx:2`): `Bar, BarChart, BarXAxis, ChartTooltip, Grid, Line, LineChart, XAxis`.
`ChartComposerDialog.tsx`, `CustomChartPanel.tsx` and `CustomChartsSection.tsx` import nothing from the
charts package — deliberate, to keep the visx bundle out of jsdom tests (`CustomChartCanvas.tsx:14`,
`CustomChartCanvas.test.tsx:8`).

Other deliberate narrowness that stays: `DASHBOARD_CHART_MAX_MEASURES = 4` (`constants.ts:474`), the
same-unit constraint enforced in zod (`schemas.ts:2993-2997`), sources `["runs","scans"]`
(`constants.ts:467`).

**What upstream actually has** (read from the installed
`@elabs-ai/components-charts@4.0.0` `dist/index.d.ts`, barrel export at `:4477`):

| Asked for | Upstream status |
| --- | --- |
| **Histogram** | **DOES NOT EXIST.** Zero case-insensitive matches for `histogram` in the whole `.d.ts`. |
| **Pivot / matrix table** | **DOES NOT EXIST.** Zero matches for `pivot`/`crosstab` in `-charts`, `-data` or `-ui`. `-data` exports only `DataTableWithRef`, `ColumnPicker`, `FacetFilter`, `FilterBar`, `SearchInput`, `toCsv`, `downloadCsv`. |
| **Radar** | **EXISTS, fully** — `RadarChart`, `RadarProvider`, `RadarArea`, `RadarAxis`, `RadarGrid`, `RadarLabels`, plus types and `defaultRadarColors`, `radarCssVars`, `useRadar`, `useRadarHover`, `useRadarStable`. |

**Radar is provably available, because this app already ships one.** `ScoreRadar` at
`apps/web/src/features/testing/report-charts.tsx:55-80` composes `RadarChart`/`RadarGrid`/`RadarLabels`/
`RadarArea` directly (imports `:2-10`, render `:63-77`), called from `ReportTab.tsx:407` with axes
built at `:326-329`. Colours go through `SCORE_TONE_CHART_COLOR`/`scoreTone` — chart tokens, no raw
colour. So radar needs **no new component, only wiring**.

Also available upstream and unused by the composer, worth knowing before proposing anything new:
`AreaChart`/`Area`, `ComposedChart`, `ScatterChart`/`Scatter`, `PieChart`, `RingChart`, `FunnelChart`,
`SankeyChart`, `Gauge`, `Sparkline`, `AutoChart`/`inferChartType`, `MetricGrid`, `ChartBrush`.

**Verdict: NOT BUILT.**

## Goal

Afterwards the composer can express the two chart shapes that actually matter for score analytics on
this bench — a multi-grader radar, and a ratio series — instead of forcing every question into a line
or a bar. And the two shapes the library genuinely cannot draw are on the owner's desk as a named
upstream request rather than quietly hand-rolled into the app.

## Scope

- **Add `radar` to `DASHBOARD_CHART_TYPES`** (`packages/shared/src/constants.ts:466`) and a `radar`
  branch to `CustomChartCanvas.tsx` composing the same upstream primitives `report-charts.tsx:55-80`
  already uses. The picker at `ChartComposerDialog.tsx:317-323` needs no change — it generates itself
  from the constant.
- **Define what a radar's axes are, and constrain the config accordingly.** A radar plots one series
  across N labelled axes, so it is only meaningful for a **grouped, non-time** query — the axes are the
  `groupBy` values (or the selected measures). Reject at zod, with a readable message, any radar config
  that would produce a time series or fewer than three axes (`ReportTab.tsx:407` already gates its own
  radar on `axes.length >= 3` — mirror that rule rather than inventing a second one).
- **Wire AM-OB4's ratio measure into the composer** once it exists: it is a `"rate"`-unit measure, so
  it composes with the existing same-unit constraint with no special case.
- **Raise histogram and pivot upstream — do not build them.** `.claude/rules/library-first.md` is
  explicit: a missing component is a real upstream gap, and the options are (1) compose from existing
  primitives or (2) raise it with the owner. Neither a histogram nor a pivot table can be composed
  honestly from what is exported. **This WP's deliverable for those two is a written gap note handed to
  the owner** — what is needed, what it would render, and why the existing parts cannot cover it —
  not a `<div>`-and-`<span>` reimplementation and not a second charting approach. If the owner declines
  the upstream request, the honest outcome is that the composer does not offer them, recorded as a
  decision.

## Files

Modify:

- `packages/shared/src/constants.ts` — ⚠ **contended**
- `packages/shared/src/types.ts` — ⚠ **contended**
- `packages/shared/src/schemas.ts` — ⚠ **contended** (the radar config constraint)
- `apps/web/src/features/dashboard/testing/CustomChartCanvas.tsx`
- `apps/web/src/features/dashboard/testing/CustomChartCanvas.test.tsx`
- `apps/web/src/features/dashboard/testing/ChartComposerDialog.tsx` — ⚠ **contended with AM-OB4**
  (the ratio numerator editor lands in the same dialog)
- `apps/web/src/features/dashboard/testing/ChartComposerDialog.test.tsx`
- `apps/web/src/features/dashboard/testing/custom-chart-query.ts` (only if the radar needs a different
  query shape)
- `apps/api/src/observability/dashboard-charts.ts` (only if the persisted config validation moves)

Add:

- a gap note for the owner covering histogram + pivot — file it in this item folder, not loose.

Untouched on purpose: `apps/web/src/features/testing/report-charts.tsx` (the shipped radar is the
reference implementation, not a thing to refactor), `apps/api/src/db/**`.

## Non-goals

- **No hand-rolled histogram, no hand-rolled pivot table, no second charting library.** This is the
  hard rule (`.claude/rules/brand-ui-only.md`), and both are named here so the boundary is unambiguous.
- No `@elabs-ai/components-*` version bump (owner-gated, lockstep across all packages —
  `.claude/rules/dependencies.md`).
- No relaxation of `DASHBOARD_CHART_MAX_MEASURES = 4` or of the same-unit constraint. The composer's
  narrowness is a design decision recorded at `constants.ts:462-465` ("this isn't a BI tool"), not an
  oversight.
- No client-side aggregation. The composer renders only what `computeRunMetrics` / `computeScanMetrics`
  return, called unmodified.
- No drag-and-resize dashboard grid.

## Dependencies

- **Depends on AM-OB4 (WP 6.4)** for the ratio clause only. The radar clause is independent and can
  ship first.
- ⚠ Shares `ChartComposerDialog.tsx` with AM-OB4 and `apps/web/src/features/dashboard/testing/`
  with AM-OB3 (which touches `panel-shell.tsx` and `CustomChartPanel.tsx`). Sequence after AM-OB4.
- The histogram/pivot half depends on an **owner decision**, and if accepted, on an upstream release —
  which is outside this repo entirely and cannot be a blocking dependency of the WP's tick.

## Migration

**None.** Chart types are a code constant and the config is a JSON blob in the existing
`dashboard_charts` row. `apps/api/src/db/{database,schema}.ts` must be a zero-line diff.

⚠ One persistence caveat: a saved chart whose `chartType` is `"radar"` will not render on an older
build. That is acceptable (this is single-owner local software with no rollback story), but do not
retroactively rewrite existing rows.

## Acceptance

1. `radar` is selectable in the composer, renders through the upstream `RadarChart` primitives, and a
   saved radar chart round-trips through `dashboard_charts` and re-renders after a reload.
2. A radar config that would produce a time series, or fewer than three axes, is **rejected at write
   with a readable message** — not rendered as an empty or misleading shape.
3. The ratio measure from WP 6.4 is selectable and composes with the same-unit constraint with no
   special case (asserted by a test that a ratio + another `"rate"` measure is accepted and a ratio +
   a `"tokens"` measure is a 400).
4. **Faithful-stub chart test (mandatory).** The composer's own suite
   (`CustomChartCanvas.test.tsx:8`, `ChartComposerDialog.test.tsx:10`) mocks
   `@elabs-ai/components-charts` as inert no-ops, so a radar wired with the wrong props would pass the
   gate silently — the blind spot recorded in the ledger for 2026-07-17. Add a faithful stub following
   `apps/web/src/features/dashboard/testing/time-axis-charts.test.tsx` (its `vi.hoisted()` captured-prop
   array plus a stub that re-implements the one contract that actually breaks). For radar, the stub must
   capture `data` and `metrics` and assert the axis count and that each axis carries a real value —
   the radar-specific analogue of that suite's `new Date(row[xDataKey]).toISOString()` check.
   **Verify the stub bites: break a prop deliberately and watch it go red before ticking.**
5. Histogram and pivot are **not** implemented in the app. A gap note exists in this item folder
   naming what each needs and why the exported primitives cannot cover it, and the owner's answer is
   recorded in the RM-17 decision log.
6. The three existing chart types render byte-identically to today (their existing tests pass
   unchanged).
7. Both themes and a keyboard pass over the composer with the new type selected — or recorded as an
   owner-acceptance line rather than claimed.
8. Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).
