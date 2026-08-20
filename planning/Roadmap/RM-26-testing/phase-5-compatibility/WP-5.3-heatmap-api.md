---
type: "Work Package Spec"
title: "WP 5.3 \u2014 Heatmap service + API routes"
description: "Status: \u2705 done 2026-06-21 (code-complete; gate green)."
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 5.3 — Heatmap service + API routes

**Status:** ✅ done 2026-06-21 (code-complete; gate green).
**Depends:** WP 5.2.

## Goal
Expose the engine over `/api`, assembling Server×Model / Tool×Model heatmaps from a real scan.

## Deliverables
- `apps/api/src/compatibility/service.ts` — `buildHeatmap(scan, modelIds, opts)`: maps `ScanDetail`
  → engine inputs, computes the matrix, worst-tool roll-up (default) or average-tool, optional
  multi-scan aggregate "environment" for the `ENV_AGGREGATE_*` caps.
- `apps/api/src/compatibility/routes.ts` — additive routes:
  - `GET /api/compatibility/models` → dataset roster (id/provider/displayName/group/window) for the picker.
  - `GET /api/scans/:scanId/heatmap?models=&view=server|tool&rollup=&client=&envScans=` → `CompatibilityHeatmap`.
- `compatibilityHeatmapQuerySchema` in `packages/shared/src/schemas.ts`; wired in `apps/api/src/index.ts`.

## Acceptance (met)
- `compatibility-service.test.ts`: server view = 1 row with a cell per model carrying drill-down
  results; tool view = 1 row per tool; the heatmap thesis holds (heavy server red on Phi-4, not red
  on a 1M model); unknown model ids are dropped from the column set.

## Notes
- Results-only over the wire (catalog/dataset stay API-side). Default column set =
  `DEFAULT_HEATMAP_MODELS` when `models` is omitted. Non-runnable providers are shown (static-only).
- 404 on unknown scan id (mirrors `/api/compare`). Reads only — runtime boundary respected.
