---
type: "Roadmap Item"
title: "Dashboard bento — the homepage Overview"
description: "Rebuild the dashboard landing surface on the bento grid, using the metric-card delta and visual props, chart datapoint clicks and the full twelve-colour chart ramp the app already owns but never switched on."
tags: ["roadmap", "RM-11"]
timestamp: "2026-08-21T15:31:35Z"
status: "done"
---

# Dashboard bento — the homepage Overview

## Goal

Rebuild the dashboard landing surface on the bento grid, using the metric-card delta and visual props, chart datapoint clicks and the full twelve-colour chart ramp the app already owns but never switched on.

## Why it matters

The homepage was not under-built, it was switched off: four capabilities already in the design system were unused.

## Milestones

- [x] Phase 1 — the grid and the list tiles.
- [x] Phase 2 — the scan tiles and drill-through.

## Linked research

No linked research yet.

## Plan overview (from the original plan README)

Plan for the `/dashboard` landing-surface review of 2026-08-19. Source review + wireframes:
the owner's published artifact (Dashboard Bento Redesign). Full findings F1–F9 and the locked
owner decisions live in the review; this folder is the executable half.

## Thesis

The homepage is not under-built, it is **switched off**. Four capabilities the app already owns
are unused: `BentoGrid`/`BentoGridItem` (never imported), `MetricCard`'s `delta`/`visual` props,
`onDatapointClick` (blocked by a comment written against charts v1.6.0 — the app is on v4), and
the full 12-colour `--chart-*` ramp (code cycles 4–5).

## Locked owner decisions

- **D-DB1** — the homepage leads with a new **blended Overview** tab (footprint + run health +
  cost + issues). Scans / Testing / Issues remain as drill-in depth.
- **D-DB2** — layout is a **fixed editorial bento**: authored spans, tiles self-hide when empty.
  No drag-resize, no persisted per-user layout, no new grid dependency.
- **D-DB3** — **no new API endpoint** and **no migration**. The Overview composes existing
  routes only.

## Invariants

1. **Library-first.** `BentoGrid`/`BentoGridItem` and `ChartCard`/`ChartFrame` come from
   `@elabs-ai/components-*`. Do not hand-roll a grid or a third copy of the chart-panel shell.
2. **Cost never blends.** `api_exact` and `subscription_reference` are shown separately (D-OB14).
3. **Honest empty states.** A tile with no data removes itself; the bento never renders a grid of
   empty boxes.
4. **Charts are gate-blind.** Chart suites mock `@elabs-ai/components-charts` as no-ops, so
   chart-prop bugs pass the gate. Every chart-touching change ships a **faithful-stub** test per
   the `time-axis-charts.test.tsx` pattern.

## Build order

Phase 0 first — all three WPs are independently shippable and improve the app before any
redesign lands. **0.1 and 0.2 overlap on five panel files and must not run in parallel**;
0.2 rebases onto 0.1.

| WP | Title | Runs with |
| --- | --- | --- |
| 0.1 | Series ramp cycles all 12 chart tokens | 0.3 |
| 0.2 | Enable `onDatapointClick`, retire the stale workaround | solo, after 0.1 |
| 0.3 | Metric tiles carry trend + sparkline + a featured tile | 0.1 |

Phase 1 (the Overview tab itself) is specced after Phase 0 lands and the owner has judged the
direction against the wireframes.

Status: [`STATUS.md`](./STATUS.md) — authoritative. Shared rules: [`conventions.md`](./conventions.md).
