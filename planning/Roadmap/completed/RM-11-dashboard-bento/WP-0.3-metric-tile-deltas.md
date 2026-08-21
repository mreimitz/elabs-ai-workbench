---
type: "Work Package Spec"
title: "WP 0.3 \u2014 Metric tiles carry trend + sparkline + a featured tile"
description: "Findings F3 + F8. MetricCardProps exposes delta, deltaDirection, positiveIsGood,"
tags: ["roadmap", "RM-11"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 0.3 — Metric tiles carry trend + sparkline + a featured tile

**Findings F3 + F8.** `MetricCardProps` exposes `delta`, `deltaDirection`, `positiveIsGood`,
`visual` ("Optional inline visual (e.g. a sparkline)") and an `emphasis` variant; `MetricGrid`
exposes `featured` + `featuredSpan` ("the headline KPI out-ranks the band") and `reveal`. The
Dashboard's eight tiles pass only `icon`/`label`/`value`/`description` in an unfeatured grid. The
tiles read flat because the props that make them not flat are never passed.

## Goal

The existing Dashboard inventory tiles gain real trend information and a visual hierarchy —
without the Overview redesign, and without a new endpoint.

## Files

- `apps/web/src/features/dashboard/ScansTab.tsx` (+ `ScansTab.test.tsx`)

This WP owns `ScansTab.tsx` exclusively. **Do not touch** any file under
`features/dashboard/testing/` (WP 0.1 and 0.2 own those).

## Notes

- Data is already present: `ScansTab` derives everything client-side from `props.scans`, and
  `buildScanDeltaIndex` / `scanDeltaFor` (`features/scans/scanDelta.ts`) already compute the token
  delta vs the previous successful same-server scan. **Reuse them** — do not add a fetch, and do
  not compute a second, differently-defined delta.
- Choose the featured tile deliberately: "Total startup tokens" is the product's headline number;
  "Servers" is a count of configuration rows. Do not feature a tile just because it is first.
- **`positiveIsGood` matters here and is easy to get backwards.** For a token footprint, *up is
  bad*. Set it so a growing footprint does not render as a success colour.
- Only give a tile a `delta` when a real comparison exists. A tile with no prior scan must show no
  delta rather than a fabricated `0` or `+0%`.
- A sparkline needs a series; where only a single latest value exists, omit `visual` rather than
  invent a shape. State in the report which tiles got a sparkline and which honestly could not.
- Sparkline is `Sparkline` from `@elabs-ai/components-charts` — it has **no** `status` prop.

## Acceptance

- [ ] The headline tile is `featured` in `MetricGrid` and out-ranks the band visually.
- [ ] Tiles with a genuine prior-period comparison carry `delta` + `deltaDirection`, and
      `positiveIsGood` is set so that a **growing token footprint reads as regression, not
      success**. Test-locked.
- [ ] No tile renders a fabricated delta when no prior scan exists.
- [ ] Any tile carrying a `visual` sparkline is backed by a real series; tiles without one are
      named in the report.
- [ ] Existing `ScansTab` behaviour (change summary, attention queue, movers, both tables) is
      unchanged.
- [ ] Gate green from the repo root.

## Not in scope

The Overview tab / `BentoGrid` (Phase 1). Chart panels (WP 0.1, 0.2). Any new API call.
