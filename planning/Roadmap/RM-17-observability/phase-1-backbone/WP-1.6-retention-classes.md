---
type: "Work Package Spec"
title: "WP 1.6 \u2014 Retention classes: pinned runs + class-aware pruning"
description: "Phase: 1 \u2014 Backbone \u00b7 Size: S \u00b7 Depends on: 1.1 \u00b7 Model: Sonnet"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.6 — Retention classes: pinned runs + class-aware pruning

**Phase:** 1 — Backbone · **Size:** S · **Depends on:** 1.1 · **Model:** Sonnet

## Objective

The LangSmith retention-upgrade idea in local form: pin runs forever, prune the rest by class.
Also the substrate for the 4.1 rule action "pin / extend retention".

## Design

- MIGRATION (claim next free version): `runs.pinned INTEGER DEFAULT 0` (+ index).
- API: `POST /api/runs/:id/pin` / `DELETE .../pin` (additive; also a RunFilter field — already
  reserved in 1.1).
- Prune: extend the maintenance family with `POST /api/maintenance/prune-runs` accepting a
  policy `{keepPinned: always, byStatus: {completed: N days|count, error: M, …}}` with
  conservative defaults OFF (no auto-prune unless configured in settings). Pinned rows are never
  pruned. Deletion goes through the existing run-delete path (events, steps, grades, FTS rows —
  coordinate with 1.3's purge hook).
- Settings: a small Storage card entry (retention policy editor can be minimal JSON-backed form;
  reuse existing Settings storage card patterns).

## Files

- `apps/api/src/db/{database,schema,rows}.ts` (migration), `apps/api/src/db/maintenance.ts`
- `apps/api/src/testing/routes.ts` (pin endpoints) — coordinate batch (contested file)
- `apps/web/src/features/settings/SettingsView.tsx` (policy entry)
- Tests: pin/unpin, prune policy honors pinned + per-status windows

## Acceptance

- [ ] Pin round-trips and filters; pinned runs survive every prune configuration (test).
- [ ] Prune deletes via the full run-delete path (grades/FTS/events gone — test with 1.3 index).
- [ ] Defaults are OFF; nothing prunes without explicit configuration.
- [ ] Migration claimed + both paths tested. Gate green.

## Notes

Touches `testing/routes.ts` — do not batch with 1.1/1.7. The feed pin UI ships inside 2.3.
