---
type: "Work Package Spec"
title: "WP 2.2 \u2014 Testing dashboard: prebuilt panels + drill-down"
description: "Phase: 2 \u2014 Monitoring surfaces \u00b7 Size: L \u00b7 Depends on: 2.1 \u00b7 Model: Sonnet"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.2 — Testing dashboard: prebuilt panels + drill-down

**Phase:** 2 — Monitoring surfaces · **Size:** L · **Depends on:** 2.1 · **Model:** Sonnet

## Objective

The fleet finally gets a time axis: prebuilt panels over `/api/metrics/runs` (+ a scans trend
strip from `/api/metrics/scans`), with a global date range, filter bar, and group-by — and every
datapoint drills down to the runs feed with the equivalent RunFilter applied.

## Design

- Global controls (top of the Testing tab): date range presets (24h / 7d / 30d / custom),
  a RunFilter subset bar (providerKind, server, environment, suite, model), group-by select
  (model | server | suite | providerKind). URL-persisted.
- Prebuilt panels (all `@elabs-ai/components-charts`, following `AnalyticsPanel.tsx` framing; `var(--chart-*)`
  series):
  1. Runs & error rate over time (count bars + error-rate line)
  2. Guardrail stops by `stopReasonCode` (stacked)
  3. Duration p50/p95 (active; wall in tooltip; fallback-marked for legacy runs)
  4. Tokens by capability class — separate marked series, never blended (D-OB14)
  5. Cost by cost-basis (`$ exact`, `$ est. subscription`, `questions` get their own panel unit)
  6. Score trend (`meanScore`, grader select defaulting to primary priority)
  7. Leaderboards: top failing tests/servers · most expensive runs (click-through lists)
  8. Scans strip: footprint tokens over time per server (from `/api/metrics/scans`)
- Drill-down: every chart datapoint/legend/leaderboard row navigates to the runs feed with the
  composed RunFilter serialized in the URL (the 1.1 helper). The feed does the rest (2.3).
- KPI header row: MetricCards for the window (runs, error rate, cost by basis, active p95).
- Empty/loading/error states per the loading-states rule; honest "no data in window" states.

## Files

- `apps/web/src/features/dashboard/TestingTab.tsx` + new panel components under
  `apps/web/src/features/dashboard/testing/`
- `apps/web/src/lib/api.ts` (metrics calls)
- Derivation helpers colocated + unit-tested (React-free, mirroring `analytics-derive.ts` style)
- Panel/component tests with fixture metric payloads

## Acceptance

- [ ] All 8 panels render from fixtures; capability classes render as separate labelled series
      (test asserts no summed series exists).
- [ ] Date range / filter / group-by round-trip through the URL and refetch correctly.
- [ ] Drill-down URLs parse back into the exact filter (helper round-trip test) for at least:
      error-rate point, stopReasonCode slice, leaderboard row.
- [ ] Loading/empty/error states per rule; no zero-filled fake series.
- [ ] Both-theme + keyboard walk = owner-acceptance. Gate green.

## Notes

Chart honesty is the review focus (conventions §2). If a wanted panel needs a measure 1.2
doesn't expose, extend 1.2's contract additively in a follow-up commit within this WP's branch
(coordinate files) — don't compute fleet aggregates client-side from raw runs.
