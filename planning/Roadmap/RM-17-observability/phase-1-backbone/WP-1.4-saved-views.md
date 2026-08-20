---
type: "Work Package Spec"
title: "WP 1.4 \u2014 Saved views"
description: "Phase: 1 \u2014 Backbone \u00b7 Size: S \u00b7 Depends on: 1.1 \u00b7 Model: Sonnet"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.4 — Saved views

**Phase:** 1 — Backbone · **Size:** S · **Depends on:** 1.1 · **Model:** Sonnet

## Objective

Name and reuse any RunFilter: a saved view is a stored filter + presentation hints, selectable
in the runs feed (2.3) and referenced by deep links.

## Design

- MIGRATION (claim next free version): `run_views(id, name, filter_json, columns_json,
  sort_json, created_at, updated_at)`. `filter_json` validated against the RunFilter schema on
  write; `columns_json`/`sort_json` are presentation hints the web owns (opaque to the API
  beyond size caps).
- CRUD: `GET/POST /api/run-views`, `PATCH/DELETE /api/run-views/:id`. Name uniqueness enforced
  (409). Wire types in `packages/shared` (additive).
- A view stores the filter — it never snapshots results (derived doctrine).

## Files

- `apps/api/src/observability/views.ts` + routes wiring (+ tests)
- `apps/api/src/db/{database,schema,rows}.ts` (migration)
- `packages/shared/src/{types,schemas}.ts`

## Acceptance

- [ ] CRUD round-trips; invalid filter_json → 400; duplicate name → 409; delete is hard.
- [ ] Stored filter re-executes through GET /api/runs identically to the inline filter (test).
- [ ] Migration claimed + both paths tested. Gate green.

## Notes

Small by design; the UI lands in 2.3. Keep the table generic enough that a future scans/issues
view could reuse the pattern (do NOT generalize now).
