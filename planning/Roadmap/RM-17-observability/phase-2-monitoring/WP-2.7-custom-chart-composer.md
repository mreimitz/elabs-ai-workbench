---
type: "Work Package Spec"
title: "WP 2.7 \u2014 Custom chart composer"
description: "Phase: 2 \u2014 Monitoring surfaces \u00b7 Size: M \u00b7 Depends on: 2.2 \u00b7 Model: Sonnet"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.7 — Custom chart composer

**Phase:** 2 — Monitoring surfaces · **Size:** M · **Depends on:** 2.2 · **Model:** Sonnet

## Objective

User-defined charts on the Testing tab (D-OB22): metric + filter + group-by + chart type,
persisted, cloneable — the LangSmith custom-dashboard idea scoped to one owner and the existing
metrics contract.

## Design

- MIGRATION (claim next free version): `dashboard_charts(id, name, config_json, position,
  created_at, updated_at)`; `config_json` = {measure(s) [same-unit constraint], RunFilter,
  groupBy, bucket, chartType: line|bar|stacked, source: runs|scans}. Zod-validated on write.
- CRUD routes (`/api/dashboard-charts`) additive; ordering via `position`.
- Composer UI: "Add chart" on the Testing tab → dialog (existing form kit + the 2.3
  filter-builder component reused) with live preview against `/api/metrics/*`; edit/clone/
  delete/reorder on each custom panel. Custom panels render under the prebuilt ones with the
  global date range applied (chart-local filter composes with the global bar — document the
  composition rule: AND).
- Honesty rules inherited: same-unit multi-measure only; capability-split series enforced by
  the API regardless of config (D-OB14).

## Files

- `apps/api/src/observability/dashboard-charts.ts` + routes (+ tests)
- `apps/api/src/db/{database,schema,rows}.ts` (migration)
- `packages/shared/src/{types,schemas}.ts`
- `apps/web/src/features/dashboard/testing/` composer dialog + custom panel renderer (+ tests)

## Acceptance

- [ ] CRUD + reorder round-trip; invalid config (mixed units, bad filter) → 400 with detail.
- [ ] Composer preview renders from live metrics fixtures; saved chart re-renders identically
      after reload; clone works.
- [ ] Global range/filter composition (AND) tested.
- [ ] Both-theme + keyboard = owner-acceptance. Gate green.

## Notes

Keep the config surface small; this is not a BI tool. Anything the metrics API can't answer is
out of scope for the composer (no client-side aggregation).
