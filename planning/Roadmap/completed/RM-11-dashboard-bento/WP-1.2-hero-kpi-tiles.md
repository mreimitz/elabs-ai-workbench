---
type: "Work Package Spec"
title: "WP 1.2 \u2014 Hero footprint chart + KPI tiles"
description: "Build the Overview's chart-bearing tiles against the committed contract"
tags: ["roadmap", "RM-11"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.2 — Hero footprint chart + KPI tiles

Build the Overview's chart-bearing tiles against the committed contract
`apps/web/src/features/dashboard/overview/overview-contract.ts`. The hook that fills it is WP 1.1,
built in parallel — **you consume the type, never its implementation.** Drive every test from your
own fixtures.

## Files (yours exclusively)

- `apps/web/src/features/dashboard/overview/tiles/HeroFootprintTile.tsx`
- `apps/web/src/features/dashboard/overview/tiles/StartupCostTile.tsx`
- `apps/web/src/features/dashboard/overview/tiles/PassRateTile.tsx`
- `apps/web/src/features/dashboard/overview/tiles/SpendByBasisTile.tsx`
- `apps/web/src/features/dashboard/overview/tiles/SurfaceMixTile.tsx`
- co-located `.test.tsx` for each

**Do NOT touch** `overview-contract.ts`, `use-overview-data.ts` / `overview-derive.ts` (WP 1.1),
`tiles/Attention*`/`tiles/Movers*`/`tiles/Advisor*` (WP 1.3), `OverviewTab.tsx` or
`DashboardView.tsx` (WP 1.4), or anything under `features/dashboard/testing/`.

## What each tile is

| Tile | Bento size | Content |
| --- | --- | --- |
| `HeroFootprintTile` | `hero` (2×2) | `AreaChart` or `LineChart`, one series per server, whole-surface footprint over time. Fleet total + Δ + the first-measured disclosure. |
| `StartupCostTile` | `sm` (1×1) | `MetricCard` — fleet startup tokens, Δ, `Sparkline` |
| `PassRateTile` | `sm` (1×1) | `MetricCard` — pass rate %, Δ in **points**, `Sparkline` |
| `SpendByBasisTile` | `md` (2×1) | One row PER cost basis. **Never a single blended total** (D-OB14). |
| `SurfaceMixTile` | `sm` (1×1) | `RingChart` — tools / resources / prompts split |

Each tile renders `<BentoGridItem>` itself (from `@elabs-ai/components-ui`) with its own `size`, so
WP 1.4 only composes them. Read `BentoGridItem`'s real props from the package `.d.ts` — do not guess.

## Hard requirements

1. **A tile whose section is empty renders `null`** — it removes itself. The bento must never show a
   grid of empty boxes. Test this per tile.
2. **`status="loading"` exists ONLY on `LineChart`/`AreaChart`/`BarChart`/`ComposedChart`.**
   `RingChart` and `Sparkline` have none — wrap those in `ChartCard loading` / `ChartFrame loading`
   instead of inventing a spinner.
3. **Series colour comes from `chartSeriesColor` (`apps/web/src/lib/chart-colors.ts`, WP 0.1).**
   Never a raw hex, never a local ramp — a `series-ramp.guardrail.test.ts` will fail you.
   A colour that is not a `var(--chart-N)` reference is silently ignored by the library.
4. **`Sparkline` is ZERO-BASELINED** (`max = Math.max(...values, 0)`, no `min`). Handing it absolute
   totals draws a flat line. Normalise to the window minimum and keep REAL figures in the label —
   `ScansTab.tsx`'s `trendProps` already does exactly this; follow it.
5. **`positiveIsGood={false}` wherever growth is bad** (tokens, spend). For pass rate, growth is
   GOOD — get this right per tile, it is the #1 thing reviewers catch.
6. **Never fabricate a delta.** `null` in the contract means render no delta, not `+0`.
7. **Charts get `onDatapointClick`** (v4 supports it; WP 0.2 established the pattern — see
   `features/dashboard/testing/datapoint-clicks.test.tsx`). The hero drills to that server's scan.

## Testing — the blind spot is real

Web suites `vi.mock` `@elabs-ai/components-charts` as no-ops, so a wrong chart prop passes the gate
silently. Every chart-bearing tile MUST ship a **faithful-stub** test that records the props the
chart actually received and asserts on them, per
`features/dashboard/testing/datapoint-clicks.test.tsx` and `.../time-axis-charts.test.tsx`. Include a
negative control so the stub itself can fail.

## Acceptance
- [ ] Five tiles, each rendering its own `BentoGridItem` with the size above.
- [ ] Every tile returns `null` when its section is empty — tested.
- [ ] Faithful-stub test per chart-bearing tile proving the real props reach the chart.
- [ ] `SpendByBasisTile` renders one row per basis; a test proves two bases are never summed.
- [ ] Sparkline series are normalised and their labels carry real figures.
- [ ] `positiveIsGood` correct per tile (growth bad for tokens/spend, good for pass rate) — tested.
- [ ] No raw colour; all series via `chartSeriesColor`.
- [ ] Both-theme safe: semantic tokens only, `className` layout-only.
- [ ] Gate green except the 2 pre-existing api failures noted below.
