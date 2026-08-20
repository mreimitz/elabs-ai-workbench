---
type: "Work Package Spec"
title: "WP 2.4 \u2014 The footprint lines differentiate by stroke, not by colour alone (D-DB4)"
description: "The --chart-1..12 ramp is not twelve distinguishable hues; seven plotted servers render as three near-identical limes, two near-identical blues and two greys."
tags: ["roadmap", "RM-11"]
timestamp: "2026-08-20T18:00:00Z"
status: "final"
---
# WP 2.4 — The footprint lines differentiate by stroke, not by colour alone (D-DB4)

## The defect, measured

Resolved from the rendered SVG's gradient stops against the owner's real data — seven plotted
servers:

| line | lightness | chroma | hue |
| --- | --- | --- | --- |
| lime | 0.875 | 0.148 | **116.5** |
| lime | 0.817 | 0.158 | **117.6** |
| lime | 0.917 | 0.095 | **113.8** |
| blue | 0.715 | 0.084 | **241.8** |
| blue | 0.895 | 0.058 | **239.4** |
| grey | 0.705 | **0.009** | — |
| grey | 0.595 | **0.004** | — |

`--chart-1..12` is **not** twelve distinguishable hues — it is roughly three hue families in
lightness steps plus two near-neutrals. Seven 2px strokes therefore give three near-identical limes,
two near-identical blues, and two greys. Series identity also rests on colour alone, which is an
accessibility problem independent of the count.

## The fix — the library's own mechanism

`@elabs-ai/components-charts` exports `seriesDashArray(index): string | undefined` — *"the
stroke-dasharray for a series index (`undefined` = solid)"*. Use it. Do **not** hand-roll a dash
ramp; `series-ramp.guardrail.test.ts` exists to stop exactly that class of local reinvention.

### The trap, verified in the shipped source

`Line`'s `dashArray` does **not** dash the whole line on its own. It styles only the *tail* segment,
and only when `dashFromIndex` is set (the prop exists for forecast styling). From
`@elabs-ai/components-charts/dist/index.js:1157`:

```js
function resolveDashTailBounds(dashFromIndex, dataLength) {
  return dashFromIndex != null && dashFromIndex >= 0 && dashFromIndex < dataLength - 1;
}
```

`dashFromIndex={0}` satisfies the bound for any series with more than one point and dashes the
**entire** line. **A `dashArray` passed without `dashFromIndex` is silently inert** — that is what
the test must pin.

### Rejected, with reasons

- `Line`'s `markers` prop is **circle-only** (`SeriesPointMarkerStyle` = fill / stroke / strokeWidth /
  ringGap / outline). It cannot vary marker *shape*, so `seriesMarkerShape` does not apply here.
- Changing or adding colours: the ramp has no more separable hues to give (see the table).

## Files

- `apps/web/src/features/dashboard/overview/tiles/HeroFootprintTile.tsx` (+ its test)
- `apps/web/src/lib/chart-colors.ts` — only if a `chartSeriesDash(i)` companion genuinely earns its
  place beside `chartSeriesColor(i)`; otherwise call `seriesDashArray` directly.

## Acceptance

- [ ] Every plotted line carries its own stroke pattern; series 0 stays solid (`seriesDashArray`
      returns `undefined` for it).
- [ ] The legend swatch shows the **same** pattern as its line — legend and chart cannot disagree.
- [ ] Colour is unchanged: still `chartSeriesColor`, still `var(--chart-N)`; the series-ramp
      guardrail stays green.
- [ ] Faithful-stub test asserts each `Line` receives BOTH its own `dashArray` AND `dashFromIndex={0}`
      (a `dashArray` alone is inert — pin it).
- [ ] Both themes at 1400px, no console errors; the WP 2.3 invariant still holds (Σ of each line's
      final value === the headline total).
