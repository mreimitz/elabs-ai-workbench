---
type: "Work Package Spec"
title: "WP 2.4 \u2014 Sessions lens"
description: "Phase: 2 \u2014 Monitoring surfaces \u00b7 Size: M \u00b7 Depends on: 2.3 \u00b7 Model: Sonnet"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.4 — Sessions lens

**Phase:** 2 — Monitoring surfaces · **Size:** M · **Depends on:** 2.3 · **Model:** Sonnet
**Gate:** owner-gated — `roadmap/unified-sessions/` Wave 3 merged (consumes the `ended` terminal, `seen` disposition, phase chips, and the End-session affordances it ships).

## Objective

The threads-table analog for this app: a lens over interactive runs answering "what's waiting
for me, what did my sessions look like" — turn count, waiting vs active time, last activity,
phase chip — labelled **"Sessions"** per D-US11 (labels only; the wire stays runs).

## Design

- A preset saved view "Sessions" in the runs feed (RunFilter `interactiveOnly`)
  switching the table to a session column set: environment, model/kind chip, turn count,
  `activeDurationMs` / `totalDurationMs` (waiting time = difference, shown as its own column),
  last activity (last event at), phase/status chip ("Waiting for you" prominent; `Ended` renders
  per the unified status module), `seen` marker (D-US2 — unseen finished sessions surface first),
  feedback chip, cost (basis-aware unit).
- A "Waiting for you" preset view (RunFilter `phase: waiting_input`) surfaced as a
  Dashboard Testing-tab KPI card ("N sessions waiting") deep-linking here.
- Turn count source: prefer an existing summary field; if absent, extend the run summary
  additively in the API (coordinate — small `packages/shared` + repository addition; declare in
  Files at claim time and respect contention).
- Per-environment p50/p95 active duration mini-stat above the table (from `/api/metrics/runs`
  with `interactiveOnly` + groupBy environment).

## Files

- Runs feed lens components under `apps/web/src/features/testing/`
- Possibly `packages/shared` + `apps/api/src/testing/run-repository.ts` (turn-count summary
  field — additive; contested, verify batch)
- Dashboard Testing tab KPI card (`features/dashboard/testing/`)
- Component tests with interactive-run fixtures

## Acceptance

- [ ] Lens renders the session column set from fixtures incl. waiting-time math, `seen`, and phase chips;
      legacy runs (no durations) degrade honestly (wall-only, marked).
- [ ] "Waiting for you" card counts match the lens filter (fixture test).
- [ ] Everything is labels/presets — no new routes, no wire noun change.
- [ ] Both-theme + keyboard = owner-acceptance. Gate green.

## Notes

Depends on the unified-sessions console affordances (its Wave 3) being merged. If turn count requires the API addition, that
sub-change follows contract-first and is called out in the handback.
