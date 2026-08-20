---
type: "Work Package Spec"
title: "WP 3.2 \u2014 Tree StepLog + nested Gantt + per-step economics"
description: "Phase: 3 \u2014 Console depth \u00b7 Size: L \u00b7 Depends on: 3.1 \u00b7 Model: Sonnet"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 3.2 — Tree StepLog + nested Gantt + per-step economics

**Phase:** 3 — Console depth · **Size:** L · **Depends on:** 3.1 · **Model:** Sonnet

## Objective

The console consumes the hierarchy and prices every step: collapsible step tree, nested Gantt
swimlanes, per-step tokens/cost/latency chips, a "hotspots" strip (slowest · costliest ·
biggest context jump). (The capability-driven KpiRail is
shipped by unified-sessions WP3.2 — this WP extends that rail, never re-implements it.)

## Design

- `StepLog`: parent/child rendering with collapse state (default: rating + tool_io collapsed);
  span-kind icons; flat runs render exactly as today.
- `RunGantt`: children as nested lanes under their parent's track; keeps its semantic-status
  color rule; old runs unchanged.
- Per-step economics: derive per-step deltas from cumulative `stepKpis`
  (`reports/run-kpi-by-step.ts` payload) + step timing → chips on steps (tokens Δ, cost Δ
  [basis-aware], duration); subtree rollups on parents from 3.1's tree.
- Hotspots strip (KPI rail or console header): top-3 jump-links — slowest step, costliest step,
  largest context jump (context snapshots already exist). Honest when data is missing
  (`tokens:"none"` runs get duration-only hotspots).
- KpiRail: verify what unified-sessions WP3.2 shipped and only ADD the hotspots strip / economics
  tiles to it — no re-implementation, no new `providerKind` forks (D-US4).

## Files

- `apps/web/src/features/testing/{StepLog,RunGantt,KpiRail,RunConsole}.tsx`,
  `analytics-derive.ts` (per-step delta helpers) + a `hotspots` helper (+ tests)
- Component tests: tree collapse, nested Gantt fixture, economics math, hotspot selection,
  capability-tile matrix (one fixture per kind)

## Acceptance

- [ ] Tree + nested Gantt render new-run fixtures; flat legacy fixture renders byte-stable.
- [ ] Per-step chips match hand-computed deltas on a fixture; subtree rollups correct.
- [ ] Hotspots pick the true extremes and jump-link to the step.
- [ ] The rail additions render per capabilities for all three kind fixtures; zero new
      `providerKind` conditionals (grep-proof test); estimated marks intact.
- [ ] Both-theme + keyboard = owner-acceptance. Gate green.

## Notes

Owns the console cluster — never batched with 2.5/3.4 or unified-sessions Wave-3 WPs. Review rejects any new `providerKind` conditional (D-US4).
