---
type: "Work Package Spec"
title: "WP 1.5 \u2014 Human feedback primitive (runfeedback)"
description: "Phase: 1 \u2014 Backbone \u00b7 Size: M \u00b7 Depends on: 1.1 \u00b7 Model: Sonnet"
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.5 — Human feedback primitive (run_feedback)

**Phase:** 1 — Backbone · **Size:** M · **Depends on:** 1.1 · **Model:** Sonnet

## Objective

One generic primitive for human signal (D-OB15): scores/notes on runs and on individual
assistant turns, filterable, strictly separate from grades. The console UI is 2.5; the review
queue is 4.5 — this WP is the table + API + filter integration.

## Design

- MIGRATION (claim next free version): `run_feedback(id, run_id, step_id NULL, key, score REAL
  NULL, comment TEXT NULL, source TEXT CHECK('human'|'auto'), created_at)`. Default key
  `"verdict"` with score −1/+1 for thumbs; arbitrary keys allowed (rubric use in 4.5).
  FK + cascade on run delete.
- API: `POST /api/runs/:id/feedback` (upsert per (run, step, key, source=human) — a re-thumb
  replaces), `GET /api/runs/:id/feedback`, `DELETE /api/runs/:id/feedback/:feedbackId`.
  Wire types additive in `packages/shared`.
- RunFilter integration: the 1.1 `feedback` field becomes live — filter by key presence and
  score comparison; run summaries gain an optional aggregate chip payload
  (`feedback: {key, score}[]` or count — keep minimal).
- **Separation (AR6/D-OB15):** nothing in grading/suites/compare reads this table. Add a
  regression test asserting suite aggregates are byte-identical with and without feedback rows.

## Files

- `apps/api/src/observability/feedback.ts` + routes (+ tests)
- `apps/api/src/db/{database,schema,rows}.ts` (migration)
- `apps/api/src/testing/run-repository.ts` (summary aggregate + filter join)
- `packages/shared/src/{types,schemas}.ts`

## Acceptance

- [ ] CRUD + upsert semantics; step-level rows accepted only for steps of that run; cascade on
      run delete.
- [ ] Filterable via RunFilter (`feedback.key`, score ranges) with fixtures.
- [ ] Separation regression test green (suite/grade outputs unchanged by feedback rows).
- [ ] Migration claimed + both paths tested. Gate green.

## Notes

`source:'auto'` exists for future rule-written feedback (4.1's run-grader action does NOT write
here — grades stay grades); keep the enum anyway for the wire's sake.
